# NodeScope Circuits

Circuits document ISP or carrier services that terminate on the network.

## Circuit Fields

- **ISP name:** Required provider name, up to 100 characters
- **Service type:** Required free text or a Fiber, Cable, DSL, Leased Line,
  Wireless, or Other preset
- **Circuit ID:** Optional carrier identifier, up to 100 characters
- **Bandwidth:** Optional value from 0.1 to 100,000 Mbps
- **Device:** Optional link to the terminating device
- **Notes:** Optional operational and support details, up to 500 characters

## Desktop Workflow

Open Inventory > Circuits to create, edit, or delete a circuit. The list is
cursor-paginated in pages of 50. Select "Load more" when another page is
available.

Deleting a linked device does not delete the circuit. NodeScope clears the
device reference and keeps the carrier record.

Circuit updates and deletions are versioned and delivered to connected clients
through SignalR.
