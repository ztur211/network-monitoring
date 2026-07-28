using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NodeScope.Migrations.Migrations
{
    /// <inheritdoc />
    public partial class BuildingModelGeoreference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "anchorLatitude",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "anchorLongitude",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "anchorX",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "anchorY",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "metersPerUnit",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "rotationDegrees",
                table: "BuildingModel",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "anchorLatitude",
                table: "BuildingModel");

            migrationBuilder.DropColumn(
                name: "anchorLongitude",
                table: "BuildingModel");

            migrationBuilder.DropColumn(
                name: "anchorX",
                table: "BuildingModel");

            migrationBuilder.DropColumn(
                name: "anchorY",
                table: "BuildingModel");

            migrationBuilder.DropColumn(
                name: "metersPerUnit",
                table: "BuildingModel");

            migrationBuilder.DropColumn(
                name: "rotationDegrees",
                table: "BuildingModel");
        }
    }
}
