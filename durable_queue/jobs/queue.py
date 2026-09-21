"""The single way in and out of the Job queue: the API sends Jobs with
enqueue_job, and the Worker handler answers the message it received through
sqs_client. The message body contract is ``{"job_id": <int>}``."""

import json
from functools import cache

import boto3
from django.conf import settings

# Matches the deployment region in infra/shared.tf. Local ElasticMQ ignores the
# region; its endpoint and placeholder credentials come from botocore's own
# AWS_ENDPOINT_URL_SQS / AWS_ACCESS_KEY_ID environment variables.
SQS_REGION = "ap-northeast-1"


@cache
def sqs_client():
    return boto3.client("sqs", region_name=SQS_REGION)


def job_queue_url():
    return settings.JOB_QUEUE_URL


def enqueue_job(job_id):
    sqs_client().send_message(
        QueueUrl=job_queue_url(),
        MessageBody=json.dumps({"job_id": job_id}),
    )
