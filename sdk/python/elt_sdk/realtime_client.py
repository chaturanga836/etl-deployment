"""Realtime subscribe client — requires optional `centrifuge-python` package."""

from __future__ import annotations

from typing import Any, Callable, Dict

import httpx

from elt_sdk.client import EltClientError


class EltRealtimeClient:
  def __init__(
      self,
      base_url: str,
      *,
      get_access_token: Callable[[], str],
      timeout: float = 60.0,
  ):
      self._base_url = base_url.rstrip("/")
      self._get_access_token = get_access_token
      self._timeout = timeout
      self._client: Any = None
      self._subscriptions: Dict[str, Any] = {}
      self._handlers: Dict[str, list[Callable[[Any], None]]] = {}

  def _auth_headers(self) -> Dict[str, str]:
      token = self._get_access_token()
      return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

  def _fetch_token(self) -> tuple[str, str]:
      with httpx.Client(timeout=self._timeout) as http:
          resp = http.get(
              f"{self._base_url}/api/v1/notifications/realtime-token",
              headers=self._auth_headers(),
          )
      if resp.status_code >= 400:
          raise EltClientError(resp.text, resp.status_code)
      data = resp.json()
      return data["token"], data["ws_url"]

  def connect(self) -> None:
      try:
          from centrifuge import Client  # type: ignore
      except ImportError as exc:
          raise EltClientError(
              "Install centrifuge-python for realtime: pip install 'elt-sdk[realtime]'",
              0,
          ) from exc

      token, ws_url = self._fetch_token()
      self._client = Client(ws_url, token=token)
      self._client.connect()

  def subscribe(self, channel: str, handler: Callable[[Any], None]) -> None:
      if not self._client:
          raise EltClientError("Not connected — call connect() first", 0)
      from centrifuge import SubscriptionEventHandler  # type: ignore

      class _Handler(SubscriptionEventHandler):
          def on_publication(self, event):  # noqa: ANN001
              handler(event.data)

      sub = self._client.new_subscription(channel, events=_Handler())
      sub.subscribe()
      self._subscriptions[channel] = sub
      self._handlers.setdefault(channel, []).append(handler)

  def unsubscribe(self, channel: str) -> None:
      sub = self._subscriptions.pop(channel, None)
      if sub is not None:
          sub.unsubscribe()
      self._handlers.pop(channel, None)

  def on(self, event: str, handler: Callable[..., None]) -> None:
      if not self._client:
          raise EltClientError("Not connected — call connect() first", 0)
      self._client.on(event, handler)

  def disconnect(self) -> None:
      for channel in list(self._subscriptions.keys()):
          self.unsubscribe(channel)
      if self._client is not None:
          self._client.disconnect()
          self._client = None
