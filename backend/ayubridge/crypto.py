"""GCP Cloud KMS stand-in: versioned HMAC-SHA256 consent-token signing.

Production flow (ayubridge/safety/consent_manager.py): every consent state is
hashed, the hash is signed by the current Cloud KMS key version, and revocation
rotates the key version so historical signatures can no longer be recomputed.
Here the same ceremony runs over versioned symmetric keys held in-process.
"""

import hashlib
import hmac
import secrets

from . import config


class KeyManagementService:
    def __init__(self) -> None:
        self._versions: dict[int, bytes] = {1: secrets.token_bytes(32)}
        self._current = 1

    @property
    def key_version(self) -> int:
        return self._current

    def key_uri(self) -> str:
        return (
            f"projects/{config.GCP_PROJECT_ID}/locations/asia-south1/"
            f"keyRings/{config.KMS_KEY_RING}/cryptoKeys/{config.KMS_KEY_NAME}"
        )

    def key_uri_at(self, version: int) -> str:
        return f"{self.key_uri()}@v{version}"

    def rotate(self) -> int:
        """Revocation ceremony step 1 — invalidate the previous key version."""
        self._current += 1
        self._versions[self._current] = secrets.token_bytes(32)
        return self._current

    def sign_consent_state(self, participant_id: str, tier: str, is_active: bool) -> tuple[str, str]:
        """Returns (key_uri@version, hex signature) for the consent commitment."""
        payload = f"{participant_id}|{tier}|{str(is_active).lower()}"
        digest = hashlib.sha256(payload.encode()).digest()
        sig = hmac.new(self._versions[self._current], digest, hashlib.sha256).hexdigest()
        return self.key_uri_at(self._current), sig

    def verify(self, participant_id: str, tier: str, is_active: bool, version: int, signature: str) -> bool:
        if version not in self._versions:
            return False  # key version rotated away — signature is cryptographically dead
        payload = f"{participant_id}|{tier}|{str(is_active).lower()}"
        digest = hashlib.sha256(payload.encode()).digest()
        expected = hmac.new(self._versions[version], digest, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


kms = KeyManagementService()
