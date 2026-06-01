# NodeScope Circuits

Circuits represent ISP or carrier connections — the pipes that bring internet to your network.

## Circuit Fields

- **ISP Name**: The provider (e.g., Comcast, AT&T, Lumen)
- **Circuit ID**: The carrier's circuit identifier for support calls
- **Service Type**: Description (e.g., "1 Gbps Fiber", "100 Mbps Cable")
- **Bandwidth**: Numeric value in Mbps
- **Device**: Optional link to the device this circuit terminates on (usually a router or firewall)
- **Notes**: Free text for SLA details, contract info, support numbers

## Usage

Circuits appear in the Circuits screen. They can be associated with a device to show the connection on the map. If the associated device is deleted, the circuit remains but loses the device link.

## Pagination

The circuits list uses cursor-based pagination. Older circuits load on scroll.
