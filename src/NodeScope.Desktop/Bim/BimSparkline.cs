using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using NodeScope.Desktop.Api;

namespace NodeScope.Desktop.Bim;

/// <summary>A compact, dependency-free telemetry chart for the BIM inspector.</summary>
internal sealed class BimSparkline : Control
{
    public static readonly StyledProperty<IReadOnlyList<BimMetricPoint>?> PointsProperty =
        AvaloniaProperty.Register<BimSparkline, IReadOnlyList<BimMetricPoint>?>(nameof(Points));

    private static readonly SolidColorBrush LineBrush =
        new(Color.FromRgb(74, 163, 255));

    private static readonly Pen LinePen =
        new(LineBrush, 2);

    private static readonly Pen GridPen =
        new(new SolidColorBrush(Color.FromArgb(70, 116, 139, 170)), 1);

    static BimSparkline()
    {
        AffectsRender<BimSparkline>(PointsProperty);
    }

    public IReadOnlyList<BimMetricPoint>? Points
    {
        get => GetValue(PointsProperty);
        set => SetValue(PointsProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var area = Bounds.Deflate(8);
        if (area.Width <= 0 || area.Height <= 0)
        {
            return;
        }

        context.DrawLine(
            GridPen,
            new Point(area.Left, area.Center.Y),
            new Point(area.Right, area.Center.Y));
        if (Points is not { Count: > 0 } points)
        {
            return;
        }

        var visiblePoints = points
            .Where(static point => double.IsFinite(point.Avg))
            .OrderBy(static point => point.Bucket)
            .ToList();
        if (visiblePoints.Count == 0)
        {
            return;
        }

        var minimum = visiblePoints.Min(static point => point.Avg);
        var maximum = visiblePoints.Max(static point => point.Avg);
        var valueRange = maximum - minimum;
        var firstBucket = visiblePoints[0].Bucket;
        var timeRange = visiblePoints[^1].Bucket - firstBucket;
        if (visiblePoints.Count == 1)
        {
            context.DrawEllipse(
                LineBrush,
                null,
                area.Center,
                3,
                3);
            return;
        }

        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            for (var index = 0; index < visiblePoints.Count; index++)
            {
                var point = visiblePoints[index];
                var x = area.Left
                    + (timeRange <= TimeSpan.Zero
                        ? area.Width * index / (visiblePoints.Count - 1d)
                        : area.Width * (point.Bucket - firstBucket).Ticks / timeRange.Ticks);
                var normalized = valueRange <= double.Epsilon
                    ? 0.5d
                    : (point.Avg - minimum) / valueRange;
                var y = area.Bottom - (normalized * area.Height);
                if (index == 0)
                {
                    path.BeginFigure(new Point(x, y), false);
                }
                else
                {
                    path.LineTo(new Point(x, y));
                }
            }
        }

        context.DrawGeometry(null, LinePen, geometry);
    }
}
