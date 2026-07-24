using System;
using System.Collections.Generic;

namespace NodeScope.Migrations.Entities;

public partial class OidEntry
{
    public string Id { get; set; } = null!;

    public string OidProfileId { get; set; } = null!;

    public string Oid { get; set; } = null!;

    public string Metric { get; set; } = null!;

    public virtual OidProfile OidProfile { get; set; } = null!;
}
