FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir flask==3.0.3 kafka-python-ng==2.2.2 requests==2.32.3
COPY . /app
EXPOSE 8080
ENV PORT=8080
CMD ["python", "app.py"]
