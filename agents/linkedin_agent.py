from agents.base_agent import BaseAgent
from scrapers.linkedin import scrape_linkedin


class LinkedInAgent(BaseAgent):
    def __init__(self):
        super().__init__("LinkedIn")

    def scrape(self):
        return scrape_linkedin()


if __name__ == "__main__":
    LinkedInAgent().run()
