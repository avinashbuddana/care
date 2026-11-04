import type { Column } from '@platform/contracts';
export function valueError(value: string | null, column: Column): string | undefined {
  if (value === null) return column.nullable ? undefined : 'Required value is missing';
  if (column.maxLength !== undefined && [...value].length > column.maxLength)
    return `Length exceeds ${column.maxLength}`;
  switch (column.type) {
    case 'text':
      return undefined;
    case 'integer':
    case 'bigint': {
      if (!/^-?(0|[1-9]\d*)$/.test(value))
        return 'Expected a canonical integer (leading-zero codes should use text)';
      const num = BigInt(value);
      const min = column.type === 'integer' ? -2147483648n : -9223372036854775808n;
      const max = column.type === 'integer' ? 2147483647n : 9223372036854775807n;
      return num < min || num > max ? 'Integer is out of range' : undefined;
    }
    case 'numeric': {
      if (!/^-?\d+(\.\d+)?$/.test(value))
        return 'Expected decimal without currency symbols or exponent';
      const [whole = '', fraction = ''] = value.replace('-', '').split('.');
      const scale = column.scale ?? 10;
      return fraction.length > scale ||
        whole.replace(/^0+/, '').length > (column.precision ?? 38) - scale
        ? 'Decimal precision or scale exceeds contract; rounding is forbidden'
        : undefined;
    }
    case 'boolean':
      return /^(true|false)$/i.test(value) ? undefined : 'Expected true or false';
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ? undefined
        : 'Expected UUID';
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Expected ISO date YYYY-MM-DD';
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
        ? undefined
        : 'Invalid calendar date';
    }
    case 'timestamptz': {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value))
        return 'Expected ISO timestamp with explicit time zone';
      const clock = value.slice(11, 19).split(':').map(Number);
      if ((clock[0] ?? 99) > 23 || (clock[1] ?? 99) > 59 || (clock[2] ?? 99) > 59)
        return 'Invalid timestamp clock';
      const datePart = value.slice(0, 10);
      const date = new Date(`${datePart}T00:00:00Z`);
      if (
        Number.isNaN(Date.parse(value)) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== datePart
      )
        return 'Invalid timestamp';
      return undefined;
    }
  }
}
export function defaultValue(column: Column): string | null {
  switch (column.default) {
    case 'empty':
      return '';
    case 'zero':
      return '0';
    case 'false':
      return 'false';
    case 'none':
      return null;
  }
}
export function safeCsvCell(value: string): string {
  return /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
