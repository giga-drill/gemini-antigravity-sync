// src/popup/components/ExportPanel.tsx — 导出格式与存储选择

import { useTranslation } from 'react-i18next';

interface Props {
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  outputMode: 'download' | 'clipboard';
  theme: 'theme-notion' | 'theme-academic' | 'theme-script';
  disabled?: boolean;
  onFormatChange: (v: 'markdown' | 'pdf' | 'html' | 'txt') => void;
  onOutputModeChange: (v: 'download' | 'clipboard') => void;
  onThemeChange: (v: 'theme-notion' | 'theme-academic' | 'theme-script') => void;
}

export default function ExportPanel({
  format,
  outputMode,
  theme,
  disabled = false,
  onFormatChange,
  onOutputModeChange,
  onThemeChange,
}: Props) {
  const { t } = useTranslation();
  const isClipboardDisabled = format === 'pdf';
  const areControlsDisabled = disabled;

  return (
    <div className="space-y-2.5">
      {/* 格式选择 */}
      <div>
        <label className="popup-section-label">{t('popup.format')}</label>
        <div className="popup-option-grid popup-option-grid--compact">
          <FormatButton
            active={format === 'markdown'}
            onClick={() => onFormatChange('markdown')}
            label={t('popup.markdown')}
            icon="📝"
            disabled={areControlsDisabled}
          />
          <FormatButton
            active={format === 'pdf'}
            onClick={() => onFormatChange('pdf')}
            label={t('popup.pdf')}
            icon="📄"
            disabled={areControlsDisabled}
          />
          <FormatButton
            active={format === 'html'}
            onClick={() => onFormatChange('html')}
            label={t('popup.html') || 'HTML'}
            icon="🌐"
            disabled={areControlsDisabled}
          />
          <FormatButton
            active={format === 'txt'}
            onClick={() => onFormatChange('txt')}
            label={t('popup.txt') || 'TXT'}
            icon="🔤"
            disabled={areControlsDisabled}
          />
        </div>
      </div>

      {/* 输出方式 */}
      <div>
        <label className="popup-section-label">{t('popup.outputMode')}</label>
        <div className="popup-option-grid popup-option-grid--compact">
          <FormatButton
            active={outputMode === 'download'}
            onClick={() => onOutputModeChange('download')}
            label={t('popup.download')}
            icon="⬇️"
            disabled={areControlsDisabled}
          />
          <FormatButton
            active={outputMode === 'clipboard'}
            onClick={() => onOutputModeChange('clipboard')}
            label={t('popup.clipboard')}
            icon="📋"
            disabled={areControlsDisabled || isClipboardDisabled}
            className={isClipboardDisabled ? 'disabled' : ''}
          />
        </div>
      </div>

      {format === 'pdf' && (
        <div>
          <label className="popup-section-label">{t('popup.theme') || 'Theme'}</label>
          <div className="popup-option-grid popup-option-grid--theme">
            <FormatButton
              active={theme === 'theme-notion'}
              onClick={() => onThemeChange('theme-notion')}
              label={t('popup.themeNotion') || 'Notion 风格'}
              icon="🧊"
              stacked
              disabled={areControlsDisabled}
            />
            <FormatButton
              active={theme === 'theme-academic'}
              onClick={() => onThemeChange('theme-academic')}
              label={t('popup.themeAcademic') || '学术论文风格'}
              icon="📚"
              stacked
              disabled={areControlsDisabled}
            />
            <FormatButton
              active={theme === 'theme-script'}
              onClick={() => onThemeChange('theme-script')}
              label={t('popup.themeScript') || '对话剧本风格'}
              icon="🎭"
              stacked
              disabled={areControlsDisabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FormatButton({
  active,
  onClick,
  label,
  icon,
  disabled = false,
  title,
  className = '',
  stacked = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  stacked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`option-btn ${active ? 'active' : ''} ${stacked ? 'option-btn--stacked' : ''} ${className}`.trim()}
    >
      <span className="option-btn__icon">{icon}</span>
      <span className="option-btn__label">{label}</span>
    </button>
  );
}
