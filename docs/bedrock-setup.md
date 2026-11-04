# Amazon Bedrock setup

Manual proposals work when Bedrock is disabled or unavailable. The implementation uses AWS SDK v3 Converse server-side. CSV content is untrusted data, including instruction-like strings. AI output must satisfy the application-owned contract schema and is compiled through trusted templates. The model cannot call repository, SQL, shell or deployment tools.

In your existing AWS account, select a supported model/inference profile in the Bedrock console and copy its inference profile ARN. Configure that profile ARN as `modelId`, and select the corresponding AWS region. Enable required model access or marketplace permissions where the selected provider requires them. Cross-region profiles may require permissions for destination regions and model ARNs. No IAM users, profiles or cloud resources are created by this platform.

Prefer an attached IAM role or short-lived default credential chain. Grant least privilege `bedrock:InvokeModel` on the selected inference profile and required backing foundation-model resources. Use AWS documentation for the specific profile because regions and model availability vary. Explicit temporary credentials are optional; include a session token when required. Do not commit credentials.

Set `SECRET_ENCRYPTION_KEY` to a cryptographically random 32-byte key encoded as 64 hex characters. Store it outside PostgreSQL in a secret manager/environment injection. Explicit credentials are AES-GCM encrypted in database storage. Saved secret values never return through settings responses. Rotate by re-entering credentials under a new external key; retain the old key until old ciphertext is replaced. Losing the key requires reconfiguration.

Settings support region, authentication mode, profile ARN, timeout, retries, maximum output tokens and sample sharing/masking. Keep sample sharing disabled unless approved. Shared samples are bounded and masking should remain enabled for sensitive data. Test Connection before Test Schema Recommendation. Authentication/permission/profile/throttling/timeout and malformed model output are surfaced as errors, while manual proposals remain available.

Do not send patient or other sensitive source values to Bedrock without the organization's explicit data-governance authorization. Metadata and masking are not a substitute for that authorization.
