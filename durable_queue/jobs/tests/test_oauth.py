from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from unittest.mock import patch, MagicMock
from jobs.models import SocialIdentity
from jobs.views import GOOGLE_AUTH_STATE

User = get_user_model()


def _token_response(json_data):
    """假的 requests Response:.raise_for_status() 不爆、.json() 回傳指定內容。"""
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = json_data
    return resp


class GoogleCallbackTests(APITestCase):
    """Google OIDC callback 的核心決策樹。
    只測帳號解析(Case 1/2/3)與 CSRF state;
    Google 驗簽 / JWT 簽發是 library 的保證,不測。
    """

    def _set_state(self, state):
        """把 state 塞進這個 client 的 session(模擬 /login 存過)。"""
        session = self.client.session
        session[GOOGLE_AUTH_STATE] = state
        session.save()

    def _callback(self, code="good_code", state="valid_state"):
        return self.client.get(
            reverse("google_callback"), {"code": code, "state": state}
        )

    # --- Case 1:既有 Google identity → 直接登入同一個 user ---

    @patch("jobs.views.google_id_token.verify_oauth2_token")
    @patch("jobs.views.http_requests.post")
    def test_existing_identity_logs_in_same_user(self, mock_post, mock_verify):
        # Arrange:先建 user + 他的 Google identity
        user = User.objects.create_user(username="ally@test.com", email="ally@test.com")
        SocialIdentity.objects.create(
            user=user,
            provider=SocialIdentity.GOOGLE,
            provider_sub="google-sub-1",
            email="ally@test.com",
            email_verified=True,
        )
        self._set_state("valid_state")
        mock_post.return_value = _token_response({"id_token": "fake-id-token"})
        mock_verify.return_value = {
            "sub": "google-sub-1",
            "email": "ally@test.com",
            "email_verified": True,
        }
        users_before = User.objects.count()
        # Act
        resp = self._callback()
        # Assert:發了 JWT,而且沒有重複建 user
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.assertEqual(User.objects.count(), users_before)

    # --- Case 3:全新且 email 已驗證 → 建 user + identity,密碼設 unusable ---

    @patch("jobs.views.google_id_token.verify_oauth2_token")
    @patch("jobs.views.http_requests.post")
    def test_new_verified_user_is_created_with_unusable_password(
        self, mock_post, mock_verify
    ):
        # Arrange:全新的 sub / email,沒有任何既有帳號
        self._set_state("valid_state")
        mock_post.return_value = _token_response({"id_token": "fake-id-token"})
        mock_verify.return_value = {
            "sub": "google-sub-new",
            "email": "newbie@test.com",
            "email_verified": True,
        }
        # Act
        resp = self._callback()
        # Assert:發 JWT + user 和 identity 兩張都建了
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", resp.data)
        user = User.objects.get(email="newbie@test.com")
        self.assertTrue(
            SocialIdentity.objects.filter(
                provider=SocialIdentity.GOOGLE,
                provider_sub="google-sub-new",
                user=user,
            ).exists()
        )
        # Google-only 使用者不能用密碼登入(統一認證出口的靈魂,守住別被人補上 password)
        self.assertFalse(user.has_usable_password())

    # --- Case 2:同 email 已有 local 帳號 → 擋下,不自動綁(安全核心) ---

    @patch("jobs.views.google_id_token.verify_oauth2_token")
    @patch("jobs.views.http_requests.post")
    def test_existing_local_email_is_blocked_no_autolink(self, mock_post, mock_verify):
        # Arrange:已有一個同 email 的 local 帳號(沒有 Google identity)
        User.objects.create_user(username="taken", email="taken@test.com", password="x")
        self._set_state("valid_state")
        mock_post.return_value = _token_response({"id_token": "fake-id-token"})
        mock_verify.return_value = {
            "sub": "google-sub-x",
            "email": "taken@test.com",
            "email_verified": True,
        }
        users_before = User.objects.count()
        # Act
        resp = self._callback()
        # Assert:409 擋下,而且「什麼都沒發生」— 沒建人、沒自動綁 identity
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(User.objects.count(), users_before)
        self.assertFalse(SocialIdentity.objects.exists())

    # --- Case 3 反向:全新但 email 未驗證 → 拒絕建帳號 ---

    @patch("jobs.views.google_id_token.verify_oauth2_token")
    @patch("jobs.views.http_requests.post")
    def test_new_user_with_unverified_email_is_rejected(self, mock_post, mock_verify):
        # Arrange:全新的人,但 Google 說 email 未驗證
        self._set_state("valid_state")
        mock_post.return_value = _token_response({"id_token": "fake-id-token"})
        mock_verify.return_value = {
            "sub": "google-sub-unv",
            "email": "unverified@test.com",
            "email_verified": False,
        }
        # Act
        resp = self._callback()
        # Assert:403,且沒建任何帳號 / identity
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(User.objects.filter(email="unverified@test.com").exists())
        self.assertFalse(SocialIdentity.objects.exists())

    # --- CSRF:state 對不上 → 擋在換 token 之前 ---

    @patch("jobs.views.google_id_token.verify_oauth2_token")
    @patch("jobs.views.http_requests.post")
    def test_state_mismatch_is_rejected(self, mock_post, mock_verify):
        # Arrange:session 存的是 real_state
        self._set_state("real_state")
        # Act:callback 帶回一個對不上的偽造 state
        resp = self._callback(state="forged_state")
        # Assert:400,而且根本沒去打 Google(擋在換 token 之前)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_post.assert_not_called()
        mock_verify.assert_not_called()
