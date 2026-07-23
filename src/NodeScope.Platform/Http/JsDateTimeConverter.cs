using System.Text.Json;
using System.Text.Json.Serialization;

namespace NodeScope.Platform.Http;

/// <summary>
/// Serializes <see cref="DateTime"/> the way <c>JSON.stringify</c> serializes a JS
/// <c>Date</c>: UTC, millisecond precision, <c>Z</c> suffix. Registered globally on the
/// host's JSON options so DTOs can carry plain <see cref="DateTime"/> properties and still
/// match the Node wire format. Unspecified kinds are treated as UTC, which is what the
/// <c>timestamp(3)</c> columns hold.
/// </summary>
public sealed class JsDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.GetDateTime();

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteStringValue(IsoTimestamp.Of(value));
    }
}
