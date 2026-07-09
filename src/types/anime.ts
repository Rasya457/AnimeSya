export interface VideoSource {
  quality: string;
  url: string;
  type: "hls" | "mp4";
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  duration: string;
  thumbnail: string;
  sources: VideoSource[];
}

export interface Anime {
  id: string;
  slug: string;
  title: string;
  japaneseTitle?: string;
  synopsis: string;
  coverImage: string;
  bannerImage: string;
  rating: number;
  year: number;
  status: "Ongoing" | "Completed";
  episodesCount: number;
  genres: string[];
  episodes: Episode[];
  isTrending?: boolean;
}

export interface Comment {
  id: string;
  user: {
    name: string;
    avatar: string;
  };
  content: string;
  timestamp: string;
  likes: number;
}

export interface AnimeCard {
  slug: string
  title: string
  poster: string
  latestEpisode?: string
  score?: number
  status?: 'Ongoing' | 'Completed'
  genres?: string[]
}

export interface AnimeListItem {
  animeId: string
  title: string
  poster: string
  episodes: number | string
  releaseDay?: string
  latestReleaseDate?: string
  genres: string[]
  score: number | null
  status: 'Ongoing' | 'Completed'
}

export interface RelatedAnime {
  malId: string
  title: string
  relation: string
  poster?: string        // undefined → shows "No Poster" fallback
  score?: number
  type?: string
  status?: string
}

export interface AnimeDetail {
  slug: string
  title: string
  alternativeTitle?: string
  altTitles?: string[]
  poster: string
  score: number
  status: 'Ongoing' | 'Completed'
  type: 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special'
  totalEpisodes: number | string
  aired: string
  studio: string
  genres: Genre[]
  synopsis: string
  episodes: EpisodeListItem[]
  relations?: RelatedAnime[]
}

export interface EpisodeListItem {
  slug: string
  title: string
  episodeNumber: number
  uploadDate?: string
}

export interface StreamSource {
  provider: string
  url: string
  isEmbed: boolean  // true = iframe, false = direct stream
}

export interface StreamQuality {
  quality: string   // '360p' | '480p' | '720p' | '1080p'
  sources: StreamSource[]
}

export interface EpisodeDetail {
  slug: string
  title: string
  animeTitle: string
  animeSlug: string
  episodeNumber: number
  streams: StreamQuality[]
  prevEpisode: string | null
  nextEpisode: string | null
}

export interface Genre {
  slug: string
  name: string
}

export interface ApiResponse<T> {
  statusCode: number
  statusMessage: string
  data: T
  pagination: Pagination | null
}

export interface Pagination {
  currentPage: number
  lastPage: number
  hasNextPage: boolean
}

