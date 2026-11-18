#!/bin/bash
# Copies migration 0304 (signed applications, offers, credit check link) to the clipboard and opens the Supabase SQL editor.
pbcopy < "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/supabase/migrations/0304_application_signature_offers.sql"
open "https://supabase.com/dashboard/project/nvhvdyxpyogvadpjlvij/sql/new"
echo "0304 is on your clipboard. Paste it in the editor (Cmd+V) and press Run."
