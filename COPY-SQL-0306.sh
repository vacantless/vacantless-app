#!/bin/bash
# Copies migration 0306 (Send to Vacantless keys) to the clipboard and opens the Supabase SQL editor.
pbcopy < "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/supabase/migrations/0306_capture_keys.sql"
open "https://supabase.com/dashboard/project/nvhvdyxpyogvadpjlvij/sql/new"
echo "0306 is on your clipboard. Paste it in the editor (Cmd+V) and press Run."
