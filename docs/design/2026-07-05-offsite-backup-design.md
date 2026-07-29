# Encrypted offsite backup

Date: 2026-07-05  
Status: implemented on the .NET appliance  
Parent: `2026-06-30-local-first-architecture-direction.md`

## Purpose

Local backup protects against software failure and routine operator mistakes, but
it does not survive appliance theft, fire, or site loss. NodeScope therefore
supports an optional encrypted copy in a dedicated S3-compatible bucket.

Backup data crosses the site boundary only as authenticated ciphertext. The
appliance normally retains the public encryption key and can create backups, but
the private recovery identity is kept off the appliance.

## Scope

The feature operates on the complete local bundle produced by
`nodescope.sh backup`:

```text
nodescope-YYYYMMDD-HHMMSS/
  db.sql.gz
  blobs.tar.gz
  manifest.txt
```

`OFFSITE_INCLUDE_BLOBS=false` permits a database-only copy when model storage
cost dominates. That mode is explicit because disaster recovery will have no
IFC, BCF, or other object-store content.

Continuous WAL archiving, point-in-time recovery, remote bucket provisioning,
and key rotation are outside this capability.

## Trust model

The recovery provider can observe object names, encrypted sizes, and upload
timing. It cannot read database or blob content.

The appliance stores:

- the public backup key
- dedicated S3 endpoint and credentials
- local plaintext data and local backup bundles

The recovery identity stores:

- the same public key
- the PKCS#8 private key

The identity must be copied to protected storage outside the site. Loss of that
identity makes the encrypted objects unrecoverable. An attacker with bucket
credentials can delete ciphertext, so provider-side retention, object locking,
and separate credential custody remain recommended.

## Cryptographic format

The versioned object format begins with `NSOB2`.

1. Generate a random 256-bit data key.
2. Wrap it with RSA-OAEP using SHA-256 and the appliance public key.
3. Generate a random 64-bit nonce prefix.
4. Split the tar stream into frames no larger than 1 MiB.
5. Encrypt each frame with AES-256-GCM. The nonce is the random prefix followed
   by a monotonically increasing 32-bit frame counter.
6. Authenticate the complete header hash, frame counter, plaintext length, and
   final-frame marker as associated data.
7. Write a zero-length authenticated final frame.

The bounded length is checked before allocation. Nonce reuse is prevented by
the frame limit. Header modification, frame reordering, truncation, trailing
data, bit corruption, and use of the wrong private key all fail closed.

RSA is 3072 bits. Public keys are DER SubjectPublicKeyInfo values encoded with
Base64. Private keys are DER PKCS#8 values encoded with Base64.

## Archive safety

The packer emits only three known top-level regular files. The extractor stages
within the destination filesystem and accepts only:

- `manifest.txt`
- `db.sql.gz`
- optional `blobs.tar.gz`

Links, absolute paths, traversal paths, duplicate entries, unexpected entries,
and existing destinations are rejected. A successful staged directory is
renamed into place only after required entries are present.

## Transport

`NodeScope.Backup` uses the current AWS S3 SDK with path-style addressing so it
works with S3, R2, B2, Wasabi, and MinIO-compatible targets. Offsite credentials
are separate from the primary object-store credentials.

Push flow:

1. Validate the local bundle.
2. Stream tar output into the authenticated encryptor.
3. Write only ciphertext to a temporary file.
4. Upload with the SDK multipart transfer utility.
5. List the configured prefix and delete objects older than `OFFSITE_KEEP`.
6. Remove the temporary ciphertext file.

Pull flow:

1. Stream the remote ciphertext through authenticated decryption.
2. Write a temporary clear tar on the recovery host.
3. Validate and extract into a same-filesystem staging directory.
4. Atomically rename the recovered bundle.
5. Remove temporary material on success or failure.

The S3 response is consumed as a stream, so ciphertext is not buffered in
memory.

## Operations

`nodescope.sh` provides:

- `offsite-keygen`
- `offsite-push`
- `offsite-list`
- `offsite-pull`
- `offsite-restore`

The scheduled local backup service invokes `offsite-push` only after a
successful local bundle. An unconfigured target is a clean no-op. A configured
target failure marks the unit failed while leaving the completed local backup
intact.

Update backups remain local so provider availability cannot block a requested
software update.

## Validation

The unit suite covers:

- empty, small, and multi-frame encryption round trips
- ciphertext tampering
- wrong recovery identities
- truncation
- full and database-only archive round trips
- traversal rejection
- atomic destination behavior
- push, list, pull, and remote retention together

Deployment validation adds a real API-image to MinIO round trip after the local
database and blob restore test.
