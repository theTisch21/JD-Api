FROM node:16
WORKDIR /code
EXPOSE 3121
ENV DOCKER=yes
COPY . .
RUN npm i
RUN npm run build
CMD [ "npm", "run", "start" ]