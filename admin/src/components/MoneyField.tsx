import { Field, Input } from './ui';
import { parseMoney, vnd } from '../lib/format';

/** Ô nhập tiền gõ tắt ("25tr", "450k"), hiện số đầy đủ bên dưới để kiểm tra. */
export function MoneyField({
  label,
  value,
  onChange,
  required,
  placeholder = 'VD 25tr, 450k',
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const parsed = parseMoney(value);
  const preview = value.trim() ? (parsed === null ? 'Không đọc được số tiền' : vnd(parsed)) : hint;
  return (
    <Field label={label} hint={preview}>
      {(id) => (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="text"
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          aria-invalid={value.trim() !== '' && parsed === null}
          className="num"
        />
      )}
    </Field>
  );
}

/** Số tiền -> chuỗi gõ tắt để điền sẵn vào ô ("25tr", "450k"). */
export function moneyText(value: number) {
  if (!value) return '';
  if (value % 1_000_000 === 0) return `${value / 1_000_000}tr`;
  if (value % 1000 === 0) return `${value / 1000}k`;
  return String(value);
}
