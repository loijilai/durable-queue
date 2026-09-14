"""Local-only poll shim. Production has no poll loop: Lambda's SQS event source
mapping calls jobs.worker.handler directly. This only imitates that layer:
receive one message, build an event of the same shape, call the same handler,
delete the message only if the handler returns normally, and otherwise leave
it for SQS to redeliver once its visibility timeout expires."""

import logging

from django.core.management.base import BaseCommand

from jobs import queue
from jobs.worker import handler

logger = logging.getLogger(__name__)

LONG_POLL_SECONDS = 20


def _lambda_record(message):
    return {
        "messageId": message["MessageId"],
        "receiptHandle": message["ReceiptHandle"],
        "body": message["Body"],
        "attributes": message.get("Attributes", {}),
        "eventSource": "aws:sqs",
    }


class Command(BaseCommand):
    help = "Local-only worker: long-poll the Job queue and invoke the Lambda handler."

    def handle(self, *args, **options):
        client = queue.sqs_client()
        queue_url = queue.job_queue_url()
        logger.info("local worker polling", extra={"queue_url": queue_url})

        while True:
            response = client.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=1,  # matches the ESM's batch_size = 1
                WaitTimeSeconds=LONG_POLL_SECONDS,
                MessageSystemAttributeNames=["ApproximateReceiveCount"],
            )
            for message in response.get("Messages", []):
                try:
                    handler({"Records": [_lambda_record(message)]}, None)
                except Exception:
                    logger.exception("handler raised; message left for redelivery")
                    continue
                client.delete_message(
                    QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"]
                )
