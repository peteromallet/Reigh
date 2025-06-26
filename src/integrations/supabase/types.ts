export interface Database {
  public: {
    Tables: {
      shots: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          project_id: string;
        };
      };
      shot_images: {
        Row: {
          id: string;
          shot_id: string;
          generation_id: string;
          position?: number;
        };
      };
      generations: {
        Row: {
          id: string;
          location: string;
          params: any;
          createdAt: string;
          type: string;
          prompt?: string;
        };
      };
    };
  };
}
