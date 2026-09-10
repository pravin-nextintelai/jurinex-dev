Demo videos, one per product, played on /products/<id>:

  create-case.mp4        case-storage.mp4      quick-chat.mp4
  ai-drafting.mp4        citation-research.mp4

Each has a matching .jpg poster (frame at 6 s). Regenerate with:
  ffmpeg -y -ss 6 -i <id>.mp4 -frames:v 1 -vf scale=1280:-1 -q:v 4 <id>.jpg
