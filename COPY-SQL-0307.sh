#!/bin/bash
# Copies migration 0307 (key table access) to the clipboard and opens the Supabase SQL editor.
pbcopy < "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/supabase/migrations/0307_capture_keys_grants.sql"
open "https://supabase.com/dashboard/project/nvhvdyxpyogvadpjlvij/sql/new"
echo "0307 is on your clipboard. Paste it in the editor (Cmd+V) and press Run."
