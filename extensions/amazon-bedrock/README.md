# Carapace Amazon Bedrock Provider

Official Carapace provider plugin for Amazon Bedrock. It adds Bedrock model discovery, text generation, embeddings, and guardrail-aware provider routing for agents that use AWS-hosted models.

Install from Carapace:

```bash
carapace plugins install @carapace/amazon-bedrock-provider
```

Configure AWS credentials and region through your normal Carapace credential/profile setup, then select Bedrock models with the `amazon-bedrock/...` provider prefix.
