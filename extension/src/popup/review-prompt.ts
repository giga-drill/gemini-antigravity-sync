export type ReviewPromptStorage = {
  exportSuccessCount?: number;
  hasClickedReview?: boolean;
};

export const REVIEW_SUCCESS_COUNTS = new Set([8, 15, 30]);

export function getNextReviewPromptState(stored: ReviewPromptStorage) {
  const nextCount = (typeof stored.exportSuccessCount === 'number' ? stored.exportSuccessCount : 0) + 1;
  const hasClickedReview = stored.hasClickedReview === true;

  return {
    nextCount,
    hasClickedReview,
    shouldShowToast: !hasClickedReview && REVIEW_SUCCESS_COUNTS.has(nextCount),
  };
}