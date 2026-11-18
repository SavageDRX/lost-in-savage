/* Settings for a public copy of Lost in Savage.
   To turn on the global leaderboard, create a free Supabase project, run tools/leaderboard.sql in its
   SQL editor, then paste the project's URL and its publishable key below (Project Settings -> API Keys;
   an older "anon public" key also works).
   The publishable key is meant to be public: the database rules in leaderboard.sql decide what it can do. */
window.LIS_CONFIG = {
  supabaseUrl: 'https://weluatexiygzjrjnhbhu.supabase.co/rest/v1/',
  supabaseAnonKey: 'sb_publishable_KVbFVLnTKZfPDBqQqCvr1Q_FNT3wLDC',
};
