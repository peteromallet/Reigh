/**
 * Stable entrypoint for JSON payload typing.
 *
 * Self-contained structural `Json` (matching the generated database types'
 * shape) so importers no longer transitively pull the generated
 * `@/integrations/supabase/types` module.
 */
export type Json = string | number | boolean | null |  { [key: string]: Json | undefined } | Json[];
