from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.check_architecture import check_jobs_directory


class ArchitectureCheckerTests(TestCase):
    def check_modules(self, **modules: str):
        with TemporaryDirectory() as directory:
            jobs_dir = Path(directory) / "jobs"
            jobs_dir.mkdir()
            for module, source in modules.items():
                (jobs_dir / f"{module}.py").write_text(source, encoding="utf-8")
            return check_jobs_directory(jobs_dir)

    def test_current_dependency_direction_is_allowed(self):
        violations = self.check_modules(
            models="from django.db import models\n",
            services="from .models import TranscriptionJob\n",
            tasks="from jobs.services import mark_running\nfrom jobs.transcribers import get_transcriber\n",
            serializers="from .models import TranscriptionJob\n",
            views="from jobs.models import TranscriptionJob\nfrom jobs.tasks import execute_job\n",
        )

        self.assertEqual(violations, [])

    def test_tasks_cannot_import_models(self):
        violations = self.check_modules(tasks="from jobs.models import TranscriptionJob\n")

        self.assertEqual([violation.code for violation in violations], ["ARCH001"])
        self.assertIn("jobs.models", violations[0].message)

    def test_combined_imports_cannot_hide_a_forbidden_dependency(self):
        violations = self.check_modules(tasks="import jobs.services, jobs.models\n")

        self.assertEqual([violation.code for violation in violations], ["ARCH001"])
        self.assertIn("jobs.models", violations[0].message)

    def test_services_cannot_depend_on_higher_layers(self):
        violations = self.check_modules(
            services="from jobs.views import JobCreateView\nfrom jobs.tasks import execute_job\n"
        )

        self.assertEqual([violation.code for violation in violations], ["ARCH001", "ARCH001"])

    def test_direct_lifecycle_assignment_outside_services_is_rejected(self):
        violations = self.check_modules(views="job.status = 'failed'\n")

        self.assertEqual([violation.code for violation in violations], ["ARCH002"])

    def test_queryset_lifecycle_update_outside_services_is_rejected(self):
        violations = self.check_modules(tasks="jobs.update(status='failed', error='x')\n")

        self.assertEqual([violation.code for violation in violations], ["ARCH003"])
        self.assertIn("error, status", violations[0].message)

    def test_model_declarations_and_service_mutations_are_allowed(self):
        violations = self.check_modules(
            models="status = object()\n",
            services="job.status = 'running'\njobs.update(status='failed')\n",
        )

        self.assertEqual(violations, [])

    def test_tests_and_migrations_are_outside_the_production_scan(self):
        with TemporaryDirectory() as directory:
            jobs_dir = Path(directory) / "jobs"
            (jobs_dir / "tests").mkdir(parents=True)
            (jobs_dir / "migrations").mkdir()
            (jobs_dir / "tests" / "test_direct_write.py").write_text(
                "job.status = 'failed'\n", encoding="utf-8"
            )
            (jobs_dir / "migrations" / "0001_initial.py").write_text(
                "job.status = 'failed'\n", encoding="utf-8"
            )

            violations = check_jobs_directory(jobs_dir)

        self.assertEqual(violations, [])
