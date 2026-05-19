import type { ParsedInteraction } from '../../shared/types';

type PromptActionsProps = {
  interaction: ParsedInteraction | null;
  disabled?: boolean;
  onAction(actionId: string): void;
};

export default function PromptActions({ interaction, disabled = false, onAction }: PromptActionsProps) {
  if (!interaction || interaction.kind === 'none' || interaction.actions.length === 0) return null;

  return (
    <div className="prompt-actions">
      <p className="eyebrow">Claude 需要你确认</p>
      <div className="prompt-action-grid">
        {interaction.actions.map((action) => (
          <button
            key={action.id}
            className={`action-button ${action.variant}`}
            type="button"
            disabled={disabled}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
