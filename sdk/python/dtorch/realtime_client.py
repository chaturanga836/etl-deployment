"""Realtime subscribe client; requires the optional centrifuge package."""

from __future__ import annotations

from typing import Any, Callable, Dict

from dtorch.errors import DtorchApiError
from dtorch.transport import AccessTokenProvider, HttpTransport


class DtorchRealtimeClient:
    def __init__(
        self,
        base_url: str,
        *,
        get_access_token: AccessTokenProvider,
        timeout: float = 60.0,
    ) -> None:
        self._http = HttpTransport(
            base_url,
            get_access_token=get_access_token,
            timeout=timeout,
        )
        self._client: Any = None
        self._subscriptions: Dict[str, Any] = {}

    def connect(self) -> None:
        try:
            from centrifuge import Client  # type: ignore[import-not-found]
        except ImportError as exc:
            raise DtorchApiError(
                "Install realtime support with: pip install 'dtorch-sdk[realtime]'"
            ) from exc

        token_response = self._http.request(
            "GET",
            "/api/v1/notifications/realtime-token",
        )
        self._client = Client(token_response["ws_url"], token=token_response["token"])
        self._client.connect()

    def subscribe(self, channel: str, handler: Callable[[Any], None]) -> None:
        if self._client is None:
            raise DtorchApiError("Not connected; call connect() first")
        from centrifuge import SubscriptionEventHandler  # type: ignore[import-not-found]

        class _Handler(SubscriptionEventHandler):
            def on_publication(self, event: Any) -> None:
                handler(event.data)

        subscription = self._client.new_subscription(channel, events=_Handler())
        subscription.subscribe()
        self._subscriptions[channel] = subscription

    def unsubscribe(self, channel: str) -> None:
        subscription = self._subscriptions.pop(channel, None)
        if subscription is not None:
            subscription.unsubscribe()

    def on(self, event: str, handler: Callable[..., None]) -> None:
        if self._client is None:
            raise DtorchApiError("Not connected; call connect() first")
        self._client.on(event, handler)

    def disconnect(self) -> None:
        for channel in list(self._subscriptions):
            self.unsubscribe(channel)
        if self._client is not None:
            self._client.disconnect()
            self._client = None


# Backward-compatible class name.
EltRealtimeClient = DtorchRealtimeClient
