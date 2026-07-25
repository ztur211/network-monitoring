using System.Collections.Specialized;
using Avalonia.Controls;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Views;

/// <summary>The onboarding wizard overlay; keeps the transcript scrolled to the newest line.</summary>
internal sealed partial class OnboardingView : UserControl
{
    public OnboardingView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) =>
        {
            if (DataContext is OnboardingViewModel wizard)
            {
                wizard.Transcript.CollectionChanged += OnTranscriptChanged;
            }
        };
    }

    private void OnTranscriptChanged(object? sender, NotifyCollectionChangedEventArgs e) =>
        TranscriptScroll.ScrollToEnd();
}
