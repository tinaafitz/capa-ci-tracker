import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * A thin wrapper around shadcn/ui Select that guarantees the trigger always
 * displays the human-readable label for the current value, working around
 * the Base UI issue where SelectValue renders the raw value string when the
 * portal-based SelectContent is closed.
 *
 * Usage:
 *   <FilterSelect
 *     value={filters.status}
 *     onValueChange={(v) => setFilters({ ...filters, status: v })}
 *     options={[
 *       { value: 'all', label: 'All Statuses' },
 *       { value: 'open', label: 'Open' },
 *     ]}
 *     className="w-40 h-8"
 *   />
 */
export function FilterSelect({
  value,
  onValueChange,
  options = [],
  placeholder,
  className = '',
  triggerClassName = '',
  ...rest
}) {
  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder ?? value

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName || className} {...rest}>
        <SelectValue placeholder={placeholder}>
          {selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
