# modal_clip_service.py
import modal

# Define the Modal image with dependencies
clip_image = modal.Image.debian_slim(python_version="3.10").pip_install(
    "torch",
    "torchvision", 
    "open-clip-torch",
    "pillow",
    "numpy",
    "fastapi",
)

app = modal.App("omnia-clip-service")

@app.cls(
    image=clip_image,
    gpu="T4",
    container_idle_timeout=300,
    allow_concurrent_inputs=10,
)
class CLIPService:
    @modal.enter()
    def load_model(self):
        import open_clip
        import torch
        
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            'ViT-L-14',
            pretrained='laion2b_s32b_b82k'
        )
        self.model = self.model.to(self.device)
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer('ViT-L-14')
        print(f"✅ CLIP model loaded on {self.device}")

    @modal.method()
    def encode_image(self, image_base64: str) -> list:
        import torch
        from PIL import Image
        import base64
        import io
        
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            image_features = self.model.encode_image(image_tensor)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        
        return image_features[0].cpu().numpy().tolist()

    @modal.method()
    def encode_text(self, text: str) -> list:
        import torch
        
        text_tokens = self.tokenizer([text]).to(self.device)
        
        with torch.no_grad():
            text_features = self.model.encode_text(text_tokens)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        
        return text_features[0].cpu().numpy().tolist()

    @modal.method()
    def encode_image_batch(self, images_base64: list) -> list:
        import torch
        from PIL import Image
        import base64
        import io
        
        images = []
        for img_b64 in images_base64:
            image_bytes = base64.b64decode(img_b64)
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            images.append(self.preprocess(image))
        
        image_tensor = torch.stack(images).to(self.device)
        
        with torch.no_grad():
            image_features = self.model.encode_image(image_tensor)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        
        return image_features.cpu().numpy().tolist()


# HTTP endpoint for single image encoding
@app.function(image=clip_image, gpu="T4", container_idle_timeout=300)
@modal.web_endpoint(method="POST")
def encode_image_endpoint(request: dict):
    service = CLIPService()
    
    if request.get("type") == "text":
        embedding = service.encode_text.remote(request["text"])
    else:
        embedding = service.encode_image.remote(request["image"])
    
    return {
        "success": True,
        "embedding": embedding,
        "dimensions": len(embedding)
    }


# HTTP endpoint for batch encoding
@app.function(image=clip_image, gpu="T4", timeout=3600, container_idle_timeout=300)
@modal.web_endpoint(method="POST")
def encode_batch_endpoint(request: dict):
    service = CLIPService()
    
    images = request.get("images", [])
    all_embeddings = []
    batch_size = 32
    
    for i in range(0, len(images), batch_size):
        batch = images[i:i + batch_size]
        embeddings = service.encode_image_batch.remote(batch)
        all_embeddings.extend(embeddings)
    
    return {
        "success": True,
        "embeddings": all_embeddings,
        "count": len(all_embeddings)
    }