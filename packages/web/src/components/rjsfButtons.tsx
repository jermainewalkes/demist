import type { IconButtonProps } from '@rjsf/utils';

/**
 * RJSF's default array buttons render Bootstrap glyphicons — empty pills
 * without Bootstrap's icon font. These templates use visible text instead.
 */

function iconButton(symbol: string, label: string) {
  return function RjsfIconButton(props: IconButtonProps) {
    const { icon, iconType, uiSchema, registry, className, ...rest } = props;
    void icon;
    void iconType;
    void uiSchema;
    void registry;
    void className;
    return (
      <button type="button" {...rest} className="rjsf-icon-btn" title={label} aria-label={label}>
        {symbol}
      </button>
    );
  };
}

export const buttonTemplates = {
  AddButton: function RjsfAddButton(props: IconButtonProps) {
    const { icon, iconType, uiSchema, registry, className, ...rest } = props;
    void icon;
    void iconType;
    void uiSchema;
    void registry;
    void className;
    return (
      <button type="button" {...rest} className="rjsf-add-btn" title="Add item">
        + add item
      </button>
    );
  },
  RemoveButton: iconButton('✕', 'Remove item'),
  MoveUpButton: iconButton('↑', 'Move up'),
  MoveDownButton: iconButton('↓', 'Move down'),
  CopyButton: iconButton('⧉', 'Copy item'),
};
