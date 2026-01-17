# Dockerfile for RunPod Serverless - DeepFashion
# Optimized for RTX 4090 with batch processing

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set python3.11 as default
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Upgrade pip
RUN python3 -m pip install --upgrade pip

# Install PyTorch with CUDA support (optimized for RTX 4090)
RUN pip3 install torch==2.1.0 torchvision==0.16.0 --index-url https://download.pytorch.org/whl/cu121

# Install Python dependencies
RUN pip3 install \
    transformers==4.36.0 \
    Pillow==10.1.0 \
    numpy==1.24.3 \
    runpod==1.5.0 \
    accelerate==0.25.0 \
    sentencepiece==0.1.99

# Set working directory
WORKDIR /app

# Copy the handler script
COPY runpod_deepfashion_batch.py /app/handler.py

# Download and cache the model during build (saves cold start time)
RUN python3 -c "from transformers import CLIPProcessor, CLIPModel; \
    CLIPProcessor.from_pretrained('patrickjohncyh/fashion-clip'); \
    CLIPModel.from_pretrained('patrickjohncyh/fashion-clip')"

# Set the entrypoint
CMD ["python3", "handler.py"]