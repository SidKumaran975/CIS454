import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class CanonicalJobUrlTests(unittest.TestCase):
    def test_linkedin_job_tracking_is_removed(self):
        result = server.canonicalize_job_url(
            "https://www.linkedin.com/comm/jobs/view/4488437515/?trackingId=abc&trk=email"
        )
        self.assertEqual(
            result,
            ("https://www.linkedin.com/jobs/view/4488437515", "linkedin:4488437515", "LinkedIn"),
        )

    def test_handshake_job_tracking_is_removed(self):
        result = server.canonicalize_job_url(
            "https://app.joinhandshake.com/stu/jobs/12345678?ref=email"
        )
        self.assertEqual(
            result,
            ("https://app.joinhandshake.com/stu/jobs/12345678", "handshake:12345678", "Handshake"),
        )

    def test_non_job_linkedin_links_are_rejected(self):
        for url in (
            "https://www.linkedin.com/comm/feed/?trk=email",
            "https://www.linkedin.com/comm/in/a-person?trk=email",
            "https://www.linkedin.com/jobs/search-results/?keywords=solutions",
        ):
            self.assertIsNone(server.canonicalize_job_url(url))


class CleanInstallTests(unittest.TestCase):
    def test_clean_install_is_generic_and_uses_speed_mode(self):
        original = (server.DATA_DIR, server.DB_PATH, server.GMAIL_CLIENT_PATH, server.GMAIL_TOKEN_PATH)
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            server.DATA_DIR = data_dir
            server.DB_PATH = data_dir / "jobtrail.db"
            server.GMAIL_CLIENT_PATH = data_dir / "google_oauth_client.json"
            server.GMAIL_TOKEN_PATH = data_dir / "google_oauth_token.json"
            try:
                server.init_db()
                dashboard = server.dashboard_payload()
                self.assertEqual(dashboard["profile"]["fullName"], "")
                self.assertEqual(dashboard["profile"]["targetRole"], "Technology roles")
                self.assertEqual(dashboard["profile"]["skills"], [])
                self.assertEqual(dashboard["settings"]["intervalMinutes"], 5)
                self.assertEqual(dashboard["metrics"]["urgent"], 0)
            finally:
                server.DATA_DIR, server.DB_PATH, server.GMAIL_CLIENT_PATH, server.GMAIL_TOKEN_PATH = original


if __name__ == "__main__":
    unittest.main()
