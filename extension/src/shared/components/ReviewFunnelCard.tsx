import { useTranslation } from 'react-i18next';

const ISSUE_URL = 'https://github.com/iplaysoft/gemini_chat_exporter/issues';
const STORE_REVIEW_URL = 'https://addons.mozilla.org/firefox/addon/gemini_chat_exporter@iplaysoft.com/reviews/';

export default function ReviewFunnelCard() {
  const { t } = useTranslation();

  return (
    <section className="rounded-2xl border border-gray-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/50 px-6 py-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="max-w-2xl space-y-1.5">
          <h2 className="text-base font-semibold text-gray-800">{t('feedback.reviewTitle')}</h2>
          <p className="text-sm leading-6 text-gray-500">
            {t('feedback.reviewDescription')}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto md:flex-shrink-0">
          <a
            href={ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-all duration-150 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
          >
            {t('feedback.reviewIssueCta')}
          </a>
          <a
            href={STORE_REVIEW_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md"
          >
            {t('feedback.reviewStoreCta')}
          </a>
        </div>
      </div>
    </section>
  );
}