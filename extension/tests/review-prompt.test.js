const { getNextReviewPromptState } = require('@/popup/review-prompt');

describe('review prompt thresholds', () => {
  test('shows the toast only on success counts 8, 15, and 30', () => {
    expect(getNextReviewPromptState({ exportSuccessCount: 7, hasClickedReview: false })).toEqual({
      nextCount: 8,
      hasClickedReview: false,
      shouldShowToast: true,
    });

    expect(getNextReviewPromptState({ exportSuccessCount: 14, hasClickedReview: false })).toEqual({
      nextCount: 15,
      hasClickedReview: false,
      shouldShowToast: true,
    });

    expect(getNextReviewPromptState({ exportSuccessCount: 29, hasClickedReview: false })).toEqual({
      nextCount: 30,
      hasClickedReview: false,
      shouldShowToast: true,
    });
  });

  test('does not show the toast outside the configured thresholds', () => {
    expect(getNextReviewPromptState({ exportSuccessCount: 2, hasClickedReview: false })).toEqual({
      nextCount: 3,
      hasClickedReview: false,
      shouldShowToast: false,
    });

    expect(getNextReviewPromptState({ exportSuccessCount: 8, hasClickedReview: false })).toEqual({
      nextCount: 9,
      hasClickedReview: false,
      shouldShowToast: false,
    });

    expect(getNextReviewPromptState({ exportSuccessCount: 15, hasClickedReview: false })).toEqual({
      nextCount: 16,
      hasClickedReview: false,
      shouldShowToast: false,
    });
  });

  test('never shows the toast again after the user has clicked review', () => {
    expect(getNextReviewPromptState({ exportSuccessCount: 7, hasClickedReview: true })).toEqual({
      nextCount: 8,
      hasClickedReview: true,
      shouldShowToast: false,
    });

    expect(getNextReviewPromptState({ exportSuccessCount: 29, hasClickedReview: true })).toEqual({
      nextCount: 30,
      hasClickedReview: true,
      shouldShowToast: false,
    });
  });

  test('starts counting safely from empty storage', () => {
    expect(getNextReviewPromptState({})).toEqual({
      nextCount: 1,
      hasClickedReview: false,
      shouldShowToast: false,
    });
  });
});
