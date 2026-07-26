# NodeScope Organizations

Every interactive account has its own native sign-in session and belongs to at
most one organization. Creating an account does not silently create an
organization. An account without membership remains signed in at the
organization access screen until one of the supported entry paths succeeds.

## First Organization on a New Appliance

`deploy/nodescope.sh install` generates `BOOTSTRAP_TOKEN` in the mode-0600
`deploy/.env` file and prints the value after a successful install.

To claim a clean appliance:

1. Open NodeScope Desktop and enter the appliance origin without `/api`.
2. Create the first user account.
3. On the organization access screen, expand "Setting up a new appliance?"
4. Enter the organization name and the bootstrap code from the installer.
5. Select "Create first organization."

The API requires all three conditions:

- A valid signed-in user
- The configured bootstrap credential
- A database containing zero organizations

Creation of the organization and its first OWNER membership happens in one
serializable database transaction. Once any organization exists, bootstrap
returns `ORG_018` and cannot create another organization. The credential can
remain in the appliance environment for upgrades because the database gate is
authoritative.

Treat the bootstrap code as a secret until the first organization is created.
Do not place it in screenshots, issue reports, or shared shell history.

## Invitation Codes

OWNER and ADMIN members create invitations in Settings > Organization.

- OWNER can invite MEMBER, ADMIN, or OWNER.
- ADMIN can invite MEMBER only.
- Each invitation is bound to one normalized email address.
- Invitations expire after seven days.
- Creating another pending invitation for the same email replaces the previous
  pending invitation.
- The credential is displayed only in the create response. Pending invitation
  lists do not reveal it.

The sender gives the complete `nodescope-invite-v1:<token>` code directly to the
recipient. The recipient creates an account or signs in with the invited email,
pastes the code into the native organization access screen, and joins without
signing in again.

The accepting account's email must match the invited email. Used, revoked, and
expired codes all fail as invalid. Legacy `https://host/invite/<token>` values
from the retired browser surface remain redeemable when pasted into the native
client.

## Domain-Based Access Requests

An organization can receive access requests for email domains already claimed
by platform administration. An organization-less user selects "Request access"
on the native access screen. NodeScope derives the domain from the signed-in
account's email and routes the request to the matching organization.

OWNER and ADMIN members review requests in Settings > Organization. Approval
adds the requester as MEMBER; denial adds no membership.

The desktop client does not currently expose domain claiming. A self-hosted
operator without a preconfigured domain should use invitation codes.

## Roster and Roles

All organization members can see the roster with names, email addresses, and
roles. OWNER and ADMIN members also see pending invitations and access requests.

The API enforces the last-owner invariant: the final OWNER cannot be demoted or
removed. The current desktop Settings surface does not yet expose member role
changes or member removal.

## Common Errors

| Code | Meaning |
| --- | --- |
| `ORG_002` | The signed-in account has no organization membership |
| `ORG_009` | The invitation is missing, expired, revoked, or already used |
| `ORG_010` | The signed-in email does not match the invitation |
| `ORG_011` | The account already belongs to an organization |
| `ORG_014` | No organization has claimed the account's email domain |
| `ORG_015` | A pending domain access request already exists |
| `ORG_016` | The appliance has no configured bootstrap credential |
| `ORG_017` | The bootstrap credential is invalid |
| `ORG_018` | The appliance already contains an organization |
