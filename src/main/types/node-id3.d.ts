declare module 'node-id3' {
  export interface Tags {
    title?: string
    artist?: string
    album?: string
    image?: {
      mime: string
      type: { id: number; name: string }
      description: string
      imageBuffer: Buffer
    }
  }

  const NodeID3: {
    update: (tags: Tags, filePath: string) => boolean
  }

  export default NodeID3
}
