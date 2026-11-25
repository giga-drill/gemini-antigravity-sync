import { useTranslation } from 'react-i18next';

interface OpenSourceFooterProps {
  compact?: boolean;
}

const ISSUE_URL = 'https://github.com/iplaysoft/gemini_chat_exporter/issues';

export default function OpenSourceFooter({ compact = false }: OpenSourceFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-slate-100 pt-3 text-center">
      <a
        href={ISSUE_URL}
        target="_blank"
        rel="noreferrer"
        className={compact
          ? 'inline-flex items-center justify-center text-[12px] text-slate-400 transition-colors duration-150 hover:text-slate-500'
          : 'inline-flex items-center justify-center text-[12px] text-slate-400 transition-colors duration-150 hover:text-slate-500'}
      >
        {t('feedback.footerIssue')}
      </a>
    </div>
  );
}