// Scenes a pumpkin can be displayed in. Shared by the client (to build them)
// and the server (to validate saved pumpkins), so keep it dependency-free.

export const SCENES = {
  studio: { label: 'Studio', icon: '🌑' },
  kitchen: { label: 'Kitchen table', icon: '🍽️' },
  cottage: { label: "Witch's cottage", icon: '🧙' },
  graveyard: { label: 'Graveyard', icon: '🪦' },
  patch: { label: 'Pumpkin patch', icon: '🌾' },
  porch: { label: 'Front porch', icon: '🏚️' },
};

export const DEFAULT_SCENE = 'kitchen';

export const isScene = (id) => Object.hasOwn(SCENES, id);
