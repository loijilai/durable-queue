from rest_framework import generics
from rest_framework import serializers
from jobs.serializers import TranscriptionJobSerializer, UserRegisterSerializer
from jobs.models import TranscriptionJob
from jobs.tasks import execute_job
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from jobs.services import retry_job
from django.http import Http404
from drf_spectacular.utils import (
    extend_schema,
    extend_schema_view,
    inline_serializer,
    OpenApiResponse,
)
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404
from django.conf import settings
import secrets
from django.shortcuts import redirect
from urllib.parse import urlencode
import requests as http_requests
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from jobs.models import SocialIdentity
from rest_framework_simplejwt.tokens import RefreshToken
from django.db import transaction
from django.contrib.auth import get_user_model

User = get_user_model()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_AUTH_STATE = "google_oauth_state"


# Create your views here.
@extend_schema_view(
    post=extend_schema(
        responses={
            201: TranscriptionJobSerializer,
            400: OpenApiResponse(description="輸入驗證失敗，例如 youtube url 格式錯誤"),
        },
    ),
)
class JobCreateView(generics.ListCreateAPIView):
    serializer_class = TranscriptionJobSerializer

    def get_queryset(self):
        return TranscriptionJob.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        job = serializer.save(owner=self.request.user)
        execute_job.delay(job.id)


@extend_schema_view(
    get=extend_schema(
        responses={
            200: TranscriptionJobSerializer,
            404: OpenApiResponse(description="job 不存在或不屬於你"),
        },
    ),
)
class JobRetrieveView(generics.RetrieveAPIView):
    serializer_class = TranscriptionJobSerializer

    def get_queryset(self):
        return TranscriptionJob.objects.filter(owner=self.request.user)


class JobRetryView(APIView):
    @extend_schema(
        request=None,
        responses={
            202: TranscriptionJobSerializer,
            404: OpenApiResponse(description="not found"),
            409: OpenApiResponse(description="job is not in failed status"),
        },
        description="Retry endpoint for Failed job",
    )
    def post(self, request, job_id):
        get_object_or_404(TranscriptionJob, id=job_id, owner=request.user)
        try:
            job = retry_job(job_id)
            execute_job.delay(job_id)  # dispatch 必定在 DB commit 後，此處需要順序保證
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        except TranscriptionJob.DoesNotExist:
            raise Http404

        serializer = TranscriptionJobSerializer(job)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)


# Authentication
class UserRegisterView(generics.CreateAPIView):
    permission_classes = [AllowAny]
    serializer_class = UserRegisterSerializer


class GoogleLoginView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        responses={302: OpenApiResponse(description="重導向到 Google 授權頁")},
        description="啟動 Google OAuth：產生 state 存進 session，redirect 到 Google 授權頁",
    )
    def get(self, request):
        state = secrets.token_urlsafe(32)
        request.session[GOOGLE_AUTH_STATE] = state

        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email",
            "state": state,
        }

        return redirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


class GoogleCallbackView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        responses={
            200: inline_serializer(
                name="GoogleTokenResponse",
                fields={
                    "access": serializers.CharField(),
                    "refresh": serializers.CharField(),
                },
            ),
            400: OpenApiResponse(
                description="缺少 code/state，或 state 與 session 不符（CSRF）"
            ),
            403: OpenApiResponse(
                description="Google email 未驗證，不允許以 Google 登入"
            ),
            409: OpenApiResponse(
                description="此 email 已有本地帳號，請先登入再連結 Google"
            ),
        },
        description="Google OAuth callback：驗證 code/state → 換 token → 發本站 JWT",
    )
    def get(self, request):
        code = request.query_params.get("code")
        state = request.query_params.get("state")
        if code is None or state is None:
            return Response(
                {"detail": "authorization code or state is None"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # === 1:state / CSRF 驗證 ===
        # middleware 已用 cookie 的 sessionid 從 backend 載好 session;從載好的 dict 讀出 /login 存的 state
        saved_state = request.session.get(GOOGLE_AUTH_STATE)
        if saved_state is None:
            return Response(
                {"detail": "invalid oauth state"}, status=status.HTTP_400_BAD_REQUEST
            )
        elif state != saved_state:
            return Response(
                {"detail": "state is not valid"}, status=status.HTTP_400_BAD_REQUEST
            )

        #   - 比對通過後,把它從 session 移除(one-time,防重放)
        request.session.pop(GOOGLE_AUTH_STATE, None)

        # === 2. 拿 code 去換 token ===
        try:
            token_resp = http_requests.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
                timeout=10,
            )
            token_resp.raise_for_status()
        except http_requests.exceptions.HTTPError:
            if token_resp.json().get("error") == "invalid_grant":
                return Response(
                    {"detail": "invalid grant, please login again"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raise

        # === 3. 驗證和解碼 id_token===
        id_tok = token_resp.json()["id_token"]
        claims = google_id_token.verify_oauth2_token(
            id_tok, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )

        sub = claims["sub"]
        email = claims["email"]
        email_verified = claims.get("email_verified", False)

        # === Case 1:這個 Google 帳號登過 → 直接登入 ===
        identity = SocialIdentity.objects.filter(
            provider=SocialIdentity.GOOGLE, provider_sub=sub
        ).first()

        if identity:
            user = identity.user

        else:
            # === Case 2:email 已經有 local 帳號 → 擋下,不自動綁 ===
            # TODO: 2a: 若已存在同 email 的 User → 回一個「請先用密碼登入再連結」的錯誤
            if User.objects.filter(email=email).exists():
                return Response(
                    {
                        "detail": "Email already registered, please login first to link with Google account",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # === Case 3:全新的人 → 必須 email_verified 才建 ===
            if not email_verified:
                return Response(
                    {"detail": "Gmail not verified, cannot login with Google"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # 3b: 建 User + SocialIdentity
            with transaction.atomic():
                user = User.objects.create_user(
                    username=email,  # Google 使用者的 username 採用 gmail
                    email=email,
                    # 不給 password → create_user 會設成 unusable(他只能用 Google 登入)
                )
                SocialIdentity.objects.create(
                    user=user,
                    provider=SocialIdentity.GOOGLE,
                    provider_sub=sub,
                    email=email,
                    email_verified=email_verified,
                )

        # === 三種情況匯流:發你自己的 JWT===
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})
