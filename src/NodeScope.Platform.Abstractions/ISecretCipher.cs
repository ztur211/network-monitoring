namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Symmetric at-rest encryption for stored secrets (SNMP credentials today). The Node
/// counterpart is <c>common/crypto/crypto.service.ts</c>: AES-256-GCM, blob layout
/// <c>iv(12) | authTag(16) | ciphertext</c>, base64. The implementations must stay
/// byte-compatible - both stacks read the same rows during the transition.
/// </summary>
public interface ISecretCipher
{
    public string Encrypt(string plaintext);

    public string Decrypt(string blob);
}
