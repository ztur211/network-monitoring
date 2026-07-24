using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;

namespace NodeScope.Migrations;

public partial class MigrationsDbContext
{
    /// <summary>
    /// EF's convention of indexing every foreign-key column is switched off because the
    /// schema this model owns was born from Prisma, which creates no such indexes - with
    /// the convention on, the Initial migration invents 18 IX_* indexes the reference
    /// schema never had. Indexes exist exactly where the scaffolded model declares them.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        ArgumentNullException.ThrowIfNull(configurationBuilder);
        configurationBuilder.Conventions.Remove<ForeignKeyIndexConvention>();
    }
}
