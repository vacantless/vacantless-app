#!/bin/bash
# Copies migration 0305 (teammate mobile) to the clipboard and opens the Supabase SQL editor.
pbcopy < "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/supabase/migrations/0305_teammate_mobile.sql"
open "https://supabase.com/dashboard/project/nvhvdyxpyogvadpjlvij/sql/new"
echo "0305 is on your clipboard. Paste it in the editor (Cmd+V) and press Run."
