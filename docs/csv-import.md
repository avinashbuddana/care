# CSV import operations

Choose an import-ready dataset, upload a CSV, inspect its profile and preview, map source headers to approved columns and explicitly ignore unwanted headers. Select insert-only or upsert; the approved non-null unique key determines matching. Mappings are saved with versions. Empty-as-null is explicit.

Validation scans the complete file, regardless of the profiling sample limit. CSV is streamed with backpressure into batch-isolated staging using COPY. Required values, strict types, length/precision, duplicate file keys, existing conflicts and references are checked. Row numbers include the header offset. Blocking errors prevent all target publication. Error values are bounded and CSV downloads escape spreadsheet formulas.

Review the validation outcome before requesting publication. Publication rechecks schema/constraints and references and uses a single transaction. Matching upserts preserve `id` and `created_at`. `updated_at` changes only when a business value differs. Unchanged rows keep timestamps. Database defaults and the merge SQL own this behavior for bulk operations.

Counts: received is parsed data rows; rejected is distinct rows with errors; valid is received minus rejected. Inserted/updated/unchanged are publication outcomes and remain zero before publication. _Updated_ counts existing rows whose stored values changed, including `source_*` metadata. Internal `updated_at` advances only when a business column changed. Progress is stage-based where exact row progress is unavailable. An import does not imply deletions for records absent from the source file.

Publication and completed status commit together. A retried queue delivery must see the committed result instead of applying it again. Do not manually change job state to bypass validation. Large strict transactions may hold locks and generate WAL: benchmark representative schemas, reference cardinality, contention and file size before raising upload limits or worker concurrency.
