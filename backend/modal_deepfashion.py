"""
═══════════════════════════════════════════════════════════════════════
DEEPFASHION ATTRIBUTE EXTRACTION - MODAL DEPLOYMENT (UPDATED)
═══════════════════════════════════════════════════════════════════════

Compatible with Modal 1.0+ API
Updated: January 2025
"""

import modal
import io
import base64
from typing import Dict, Any, Optional
from PIL import Image
import numpy as np

# Create Modal app
app = modal.App("deepfashion-attribute-extraction")

# Define the image with required dependencies and model downloads
deepfashion_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.0.0",
        "torchvision>=0.15.0",
        "transformers>=4.30.0",
        "Pillow>=9.5.0",
        "numpy>=1.24.0",
        "fastapi[standard]>=0.115.0", 
    )
    .run_commands(
        # Download Fashion-CLIP model during image build (caching)
        "python -c 'from transformers import CLIPProcessor, CLIPModel; "
        "CLIPProcessor.from_pretrained(\"patrickjohncyh/fashion-clip\"); "
        "CLIPModel.from_pretrained(\"patrickjohncyh/fashion-clip\")'"
    )
)

# Attribute vocabularies
CATEGORY_LABELS = [
    'dress', 'top', 'shirt', 'blouse', 't-shirt', 'sweater', 'hoodie',
    'jacket', 'coat', 'pants', 'jeans', 'shorts', 'skirt',
    'shoes', 'sneakers', 'boots', 'sandals', 'heels',
    'bag', 'backpack', 'hat', 'scarf', 'belt', 'sunglasses'
]

SLEEVE_LENGTH_LABELS = ['sleeveless', 'short', 'long', 'three-quarter']

COLOR_LABELS = [
    'black', 'white', 'gray', 'red', 'blue', 'green', 'yellow', 'orange',
    'pink', 'purple', 'brown', 'beige', 'navy', 'burgundy', 'cream'
]

GENDER_LABELS = ['men', 'women', 'boys', 'girls', 'unisex', 'kids']

PATTERN_LABELS = ['solid', 'striped', 'plaid', 'floral', 'geometric', 'dots', 'animal']

NECKLINE_LABELS = ['round', 'v-neck', 'collar', 'turtleneck', 'scoop', 'square', 'off-shoulder']

LENGTH_LABELS = ['mini', 'knee', 'midi', 'maxi', 'ankle']


@app.cls(
    image=deepfashion_image,
    gpu="T4",
    scaledown_window=300,  # Keep warm for 5 minutes
)
class DeepFashionExtractor:
    """
    DeepFashion attribute extraction using Fashion-CLIP
    """
    
    @modal.enter()
    def load_models(self):
        """Load models when container starts"""
        import torch
        from transformers import CLIPProcessor, CLIPModel
        
        print("🔧 Loading Fashion-CLIP model...")
        
        self.processor = CLIPProcessor.from_pretrained("patrickjohncyh/fashion-clip")
        self.model = CLIPModel.from_pretrained("patrickjohncyh/fashion-clip")
        self.model.eval()
        
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model.to(self.device)
        
        print(f"✅ Models loaded on {self.device}")
    
    def preprocess_image(self, image_data: str, mime_type: str) -> Image.Image:
        """Preprocess base64 image data"""
        try:
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
            
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            return image
        except Exception as e:
            raise ValueError(f"Failed to preprocess image: {str(e)}")
    
    def extract_category(self, image: Image.Image) -> Dict[str, Any]:
        """Extract category using zero-shot classification"""
        import torch
        
        text_prompts = [f"a photo of a {category}" for category in CATEGORY_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'category': CATEGORY_LABELS[top_idx],
            'confidence': float(confidence),
        }
    
    def extract_color(self, image: Image.Image) -> Dict[str, Any]:
        """Extract dominant color"""
        import torch
        
        text_prompts = [f"{color} clothing" for color in COLOR_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'color': COLOR_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    def extract_sleeve_length(self, image: Image.Image, category: str) -> Optional[Dict[str, Any]]:
        """Extract sleeve length (only for tops/dresses)"""
        import torch
        
        if category not in ['dress', 'top', 'shirt', 'blouse', 't-shirt', 'sweater', 'hoodie', 'jacket', 'coat']:
            return None
        
        text_prompts = [f"{sleeve} sleeve clothing" for sleeve in SLEEVE_LENGTH_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'sleeveLength': SLEEVE_LENGTH_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    def extract_gender(self, image: Image.Image) -> Dict[str, Any]:
        """Extract gender/target audience"""
        import torch
        
        text_prompts = [f"{gender} fashion" for gender in GENDER_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'gender': GENDER_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    def extract_pattern(self, image: Image.Image) -> Dict[str, Any]:
        """Extract pattern/print"""
        import torch
        
        text_prompts = [f"{pattern} pattern clothing" for pattern in PATTERN_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'pattern': PATTERN_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    def extract_neckline(self, image: Image.Image, category: str) -> Optional[Dict[str, Any]]:
        """Extract neckline type"""
        import torch
        
        if category not in ['dress', 'top', 'shirt', 'blouse', 't-shirt', 'sweater']:
            return None
        
        text_prompts = [f"{neckline} neckline" for neckline in NECKLINE_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'neckline': NECKLINE_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    def extract_length(self, image: Image.Image, category: str) -> Optional[Dict[str, Any]]:
        """Extract garment length"""
        import torch
        
        if category not in ['dress', 'skirt']:
            return None
        
        text_prompts = [f"{length} length dress" for length in LENGTH_LABELS]
        
        inputs = self.processor(
            text=text_prompts,
            images=image,
            return_tensors="pt",
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)[0]
        
        top_idx = probs.argmax().item()
        confidence = probs[top_idx].item()
        
        return {
            'length': LENGTH_LABELS[top_idx],
            'confidence': float(confidence)
        }
    
    @modal.method()
    def analyze(self, image_data: str, mime_type: str = "image/jpeg") -> Dict[str, Any]:
        """
        Extract all fashion attributes from an image
        """
        print("🎨 Starting fashion attribute extraction...")
        
        try:
            # Preprocess image
            image = self.preprocess_image(image_data, mime_type)
            print(f"   ✅ Image preprocessed: {image.size}")
            
            # Extract category first
            category_result = self.extract_category(image)
            category = category_result['category']
            print(f"   📂 Category: {category} (confidence: {category_result['confidence']:.2f})")
            
            # Extract color
            color_result = self.extract_color(image)
            print(f"   🎨 Color: {color_result['color']} (confidence: {color_result['confidence']:.2f})")
            
            # Extract gender
            gender_result = self.extract_gender(image)
            print(f"   👤 Gender: {gender_result['gender']} (confidence: {gender_result['confidence']:.2f})")
            
            # Extract pattern
            pattern_result = self.extract_pattern(image)
            print(f"   🔲 Pattern: {pattern_result['pattern']} (confidence: {pattern_result['confidence']:.2f})")
            
            # Conditional extractions
            sleeve_result = self.extract_sleeve_length(image, category)
            if sleeve_result:
                print(f"   👕 Sleeve: {sleeve_result['sleeveLength']} (confidence: {sleeve_result['confidence']:.2f})")
            
            neckline_result = self.extract_neckline(image, category)
            if neckline_result:
                print(f"   👔 Neckline: {neckline_result['neckline']} (confidence: {neckline_result['confidence']:.2f})")
            
            length_result = self.extract_length(image, category)
            if length_result:
                print(f"   📏 Length: {length_result['length']} (confidence: {length_result['confidence']:.2f})")
            
            # Compile results
            results = {
                'category': category,
                'color': color_result['color'],
                'gender': gender_result['gender'],
                'pattern': pattern_result['pattern'],
                'confidence': {
                    'category': category_result['confidence'],
                    'color': color_result['confidence'],
                    'gender': gender_result['confidence'],
                    'pattern': pattern_result['confidence'],
                }
            }
            
            if sleeve_result:
                results['sleeveLength'] = sleeve_result['sleeveLength']
                results['confidence']['sleeveLength'] = sleeve_result['confidence']
            
            if neckline_result:
                results['neckline'] = neckline_result['neckline']
                results['confidence']['neckline'] = neckline_result['confidence']
            
            if length_result:
                results['length'] = length_result['length']
                results['confidence']['length'] = length_result['confidence']
            
            print("   ✅ All attributes extracted successfully")
            
            return results
            
        except Exception as e:
            print(f"   ❌ Error during extraction: {str(e)}")
            raise


# Web endpoint
@app.function(image=deepfashion_image)
@modal.web_endpoint(method="POST")
def analyze_fashion_image(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Web endpoint for fashion attribute extraction
    
    Request body:
    {
        "image": "base64_encoded_image",
        "mimeType": "image/jpeg"
    }
    """
    try:
        image_data = request_data.get("image")
        mime_type = request_data.get("mimeType", "image/jpeg")
        
        if not image_data:
            return {
                "success": False,
                "error": "No image data provided"
            }
        
        # Call the model
        extractor = DeepFashionExtractor()
        results = extractor.analyze.remote(image_data, mime_type)
        
        return {
            "success": True,
            "attributes": results
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


# Local testing
@app.local_entrypoint()
def test():
    """Test the DeepFashion extractor locally"""
    import base64
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: modal run modal_deepfashion.py <image_path>")
        print("Example: modal run modal_deepfashion.py test_dress.jpg")
        return
    
    test_image_path = sys.argv[1]
    
    try:
        with open(test_image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()
        
        print(f"Testing DeepFashion with: {test_image_path}")
        print("="*80)
        
        extractor = DeepFashionExtractor()
        results = extractor.analyze.remote(image_data, "image/jpeg")
        
        print("\n" + "="*80)
        print("EXTRACTION RESULTS")
        print("="*80)
        print(f"Category: {results['category']}")
        print(f"Color: {results['color']}")
        print(f"Gender: {results['gender']}")
        print(f"Pattern: {results['pattern']}")
        
        if 'sleeveLength' in results:
            print(f"Sleeve Length: {results['sleeveLength']}")
        if 'neckline' in results:
            print(f"Neckline: {results['neckline']}")
        if 'length' in results:
            print(f"Length: {results['length']}")
        
        print("\nConfidence Scores:")
        for attr, score in results['confidence'].items():
            print(f"  {attr}: {score:.2%}")
        
    except FileNotFoundError:
        print(f"❌ Test image not found: {test_image_path}")
        print("Please provide a valid fashion image path")
    except Exception as e:
        print(f"❌ Error: {str(e)}")