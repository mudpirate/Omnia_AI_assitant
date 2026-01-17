FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

RUN python3 -m pip install --upgrade pip

RUN pip3 install torch==2.1.0 torchvision==0.16.0 --index-url https://download.pytorch.org/whl/cu121

RUN pip3 install \
    transformers==4.36.0 \
    Pillow==10.1.0 \
    numpy==1.24.3 \
    runpod==1.5.0 \
    accelerate==0.25.0 \
    sentencepiece==0.1.99

WORKDIR /app

COPY handler.py /app/handler.py

RUN python3 -c "from transformers import CLIPProcessor, CLIPModel; \
    CLIPProcessor.from_pretrained('patrickjohncyh/fashion-clip'); \
    CLIPModel.from_pretrained('patrickjohncyh/fashion-clip')"

CMD ["python3", "handler.py"]