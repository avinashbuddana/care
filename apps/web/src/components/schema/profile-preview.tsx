import type { Profile } from '@platform/contracts';
import { Badge } from '../ui/card';
import { Notice } from '../ui/feedback';
export function ProfilePreview({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <Badge>{profile.rowsSampled.toLocaleString()} rows inspected</Badge>
        <span>
          {profile.encoding} · delimiter {JSON.stringify(profile.delimiter)}
        </span>
        <Badge tone={profile.sampled ? 'warning' : 'success'}>
          {profile.sampled ? 'Bounded sample' : 'Entire file sampled'}
        </Badge>
      </div>
      {profile.sampled && (
        <Notice>
          Recommendations are based on a bounded sample. Import validation checks every row.
        </Notice>
      )}
      {profile.warnings.length > 0 && <Notice>{profile.warnings.join(' ')}</Notice>}
      <div className="table-wrap rounded-lg border border-stone-200">
        <table className="data-table">
          <thead>
            <tr>
              <th>Source column</th>
              <th>Suggested type</th>
              <th>Nulls</th>
              <th>Max length</th>
              <th>Evidence</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.source}>
                <td className="font-medium">{c.source}</td>
                <td>
                  <Badge>{c.type}</Badge>
                </td>
                <td>{c.nullPercent.toFixed(1)}%</td>
                <td>{c.maxLength}</td>
                <td className="min-w-48 max-w-72 text-xs text-stone-500">
                  {c.evidence}
                  {c.leadingZeros && ' Leading zero identifier preserved.'}
                  {c.mixed && ' Mixed values.'}
                  {c.uniqueCandidate && ' Candidate unique key; verify globally.'}
                </td>
                <td className="max-w-64 truncate text-xs text-stone-500">
                  {c.samples.join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
