down:
	docker compose -f docker-compose.yml down

prune:
	docker system prune -f

up:
	docker compose -f docker-compose.yml up -d --build

restart:
	docker compose -f docker-compose.yml down
	docker compose -f docker-compose.yml up -d --build
	docker system prune -f
