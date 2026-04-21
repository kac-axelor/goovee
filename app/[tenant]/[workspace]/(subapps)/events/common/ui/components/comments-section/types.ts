export interface Comment {
  id: string;
  contentComment: string;
  publicationDateTime: string;
  author: Author;
  image: {
    id: string;
    filePath: string;
  };
}
export interface Author {
  id: string;
  name: string;
}
export interface CommentSectionProps {
  eventId: string;
  slug: string | null;
}
